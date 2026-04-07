"""启动时补建缺失的 proxy Ingress（不限 CE/EE）。

查询所有活跃 K8s 实例，对配了 proxy_endpoint 的集群检查 ExternalName Service 和
proxy Ingress 是否存在，缺失则创建。网关 API 不可达时仅记 WARNING，不阻塞启动。
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES = {"running", "learning", "restarting", "updating", "rebuilding", "restoring"}


async def reconcile_proxy_ingresses(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    try:
        await _do_reconcile(session_factory)
    except Exception:
        logger.warning("proxy Ingress 修复跳过（网关 API 不可达或其他异常）", exc_info=True)


async def _do_reconcile(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    from kubernetes_asyncio import client as k8s_client

    from app.models.cluster import Cluster
    from app.models.instance import Instance
    from app.services.k8s.client_manager import GATEWAY_NS, k8s_manager
    from app.services.k8s.k8s_client import K8sClient
    from app.services.k8s.resource_builder import (
        build_external_name_service,
        build_proxy_ingress,
    )

    async with session_factory() as db:
        rows = await db.execute(
            select(Instance, Cluster)
            .join(Cluster, Instance.cluster_id == Cluster.id)
            .where(
                Instance.compute_provider == "k8s",
                Instance.ingress_domain.isnot(None),
                Instance.deleted_at.is_(None),
                Instance.status.in_(_ACTIVE_STATUSES),
                Cluster.proxy_endpoint.isnot(None),
                Cluster.proxy_endpoint != "",
                Cluster.deleted_at.is_(None),
            )
        )
        pairs: list[tuple[Any, Any]] = rows.all()

    if not pairs:
        logger.info("proxy reconcile: 无需修复的实例")
        return

    gateway_api = await k8s_manager.get_gateway_client()
    gateway_k8s = K8sClient(gateway_api)

    cluster_map: dict[str, Any] = {}
    instances_by_cluster: dict[str, list[Any]] = defaultdict(list)
    for inst, cluster in pairs:
        cluster_map[cluster.id] = cluster
        instances_by_cluster[cluster.id].append(inst)

    created = 0

    for cluster_id, cluster in cluster_map.items():
        ext_svc = build_external_name_service(cluster_id, cluster.proxy_endpoint)
        await gateway_k8s.create_or_skip(
            gateway_k8s.core.create_namespaced_service, GATEWAY_NS, ext_svc,
        )

        for inst in instances_by_cluster[cluster_id]:
            proxy_name = f"proxy-{inst.slug}"
            try:
                await gateway_k8s.networking.read_namespaced_ingress(proxy_name, GATEWAY_NS)
            except k8s_client.ApiException as e:
                if e.status == 404:
                    svc_name = ext_svc.metadata.name
                    proxy_ing = build_proxy_ingress(inst.slug, inst.ingress_domain, svc_name)
                    await gateway_k8s.create_or_skip(
                        gateway_k8s.networking.create_namespaced_ingress, GATEWAY_NS, proxy_ing,
                    )
                    created += 1
                    logger.info("proxy reconcile: 补建 %s -> %s", proxy_name, inst.ingress_domain)
                else:
                    logger.warning("proxy reconcile: 查询 %s 失败 (status=%d)", proxy_name, e.status)

    logger.info("proxy reconcile: 检查 %d 个实例，补建 %d 个 proxy Ingress", len(pairs), created)
