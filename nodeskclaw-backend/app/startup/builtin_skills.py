"""内置技能目录加载与幂等初始化。"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.base import not_deleted
from app.models.gene import Gene

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class BuiltinSkillSpec:
    slug: str
    name: str
    description: str | None
    category: str | None
    tags: list[str]
    version: str
    manifest: dict
    checksum: str



def _calc_checksum(payload: dict) -> str:
    normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()



def load_builtin_skill_specs(base_dir: Path | None = None) -> list[BuiltinSkillSpec]:
    root = base_dir or (Path(__file__).resolve().parent.parent / "data" / "builtin_skills")
    catalog_path = root / "catalog.json"
    if not catalog_path.exists():
        logger.info("内置技能 catalog 不存在，跳过初始化: %s", catalog_path)
        return []

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    specs: list[BuiltinSkillSpec] = []
    for row in catalog:
        slug = str(row.get("slug", "")).strip()
        if not slug:
            logger.warning("内置技能配置缺少 slug，已跳过: %s", row)
            continue
        skill_path = root / slug / "SKILL.md"
        if not skill_path.exists():
            logger.warning("内置技能文件缺失，已跳过: %s", skill_path)
            continue

        skill_content = skill_path.read_text(encoding="utf-8")
        manifest = {
            "skill": {
                "name": row.get("name") or slug,
                "content": skill_content,
            },
            "tool_allow": row.get("tool_allow", []),
        }

        scripts = row.get("scripts", [])
        if scripts:
            scripts_dir = root.parent / "gene_scripts"
            scripts_dict: dict[str, str] = {}
            for script_name in scripts:
                script_path = scripts_dir / script_name
                if not script_path.exists():
                    logger.warning("内置技能依赖脚本缺失: %s (skill=%s)", script_name, slug)
                    continue
                scripts_dict[script_name] = script_path.read_text(encoding="utf-8")
            if scripts_dict:
                manifest["scripts"] = scripts_dict

        checksum_payload = {
            "slug": slug,
            "version": row.get("version", "1.0.0"),
            "name": row.get("name") or slug,
            "description": row.get("description"),
            "category": row.get("category"),
            "tags": row.get("tags", []),
            "manifest": manifest,
        }
        checksum = _calc_checksum(checksum_payload)
        manifest["_builtin"] = {
            "checksum": checksum,
            "version": row.get("version", "1.0.0"),
        }

        specs.append(
            BuiltinSkillSpec(
                slug=slug,
                name=row.get("name") or slug,
                description=row.get("description"),
                category=row.get("category"),
                tags=row.get("tags", []),
                version=row.get("version", "1.0.0"),
                manifest=manifest,
                checksum=checksum,
            )
        )
    return specs



def _manifest_checksum(gene: Gene) -> str | None:
    if not gene.manifest:
        return None
    try:
        manifest = json.loads(gene.manifest)
    except json.JSONDecodeError:
        return None
    builtin_meta = manifest.get("_builtin")
    if not isinstance(builtin_meta, dict):
        return None
    checksum = builtin_meta.get("checksum")
    return checksum if isinstance(checksum, str) else None


async def _upsert_one_builtin_skill(db: AsyncSession, spec: BuiltinSkillSpec) -> tuple[bool, bool]:
    existing = (
        await db.execute(
            select(Gene).where(Gene.slug == spec.slug, not_deleted(Gene))
        )
    ).scalar_one_or_none()

    serialized_manifest = json.dumps(spec.manifest, ensure_ascii=False)
    serialized_tags = json.dumps(spec.tags, ensure_ascii=False)

    if existing is None:
        db.add(
            Gene(
                name=spec.name,
                slug=spec.slug,
                description=spec.description,
                category=spec.category,
                tags=serialized_tags,
                source="official",
                version=spec.version,
                manifest=serialized_manifest,
                is_published=True,
                review_status="approved",
                source_registry="builtin",
            )
        )
        return True, False

    current_checksum = _manifest_checksum(existing)
    if current_checksum == spec.checksum and existing.version == spec.version:
        return False, False

    existing.name = spec.name
    existing.description = spec.description
    existing.category = spec.category
    existing.tags = serialized_tags
    existing.source = "official"
    existing.version = spec.version
    existing.manifest = serialized_manifest
    existing.is_published = True
    existing.review_status = "approved"
    existing.source_registry = "builtin"
    return False, True


async def seed_builtin_skills(session_factory: async_sessionmaker[AsyncSession]) -> None:
    specs = load_builtin_skill_specs()
    if not specs:
        return

    created = 0
    updated = 0
    async with session_factory() as db:
        for spec in specs:
            is_created, is_updated = await _upsert_one_builtin_skill(db, spec)
            created += 1 if is_created else 0
            updated += 1 if is_updated else 0

        if created or updated:
            await db.commit()
            logger.info("内置技能初始化完成: 新增 %d，升级 %d", created, updated)
        else:
            logger.info("内置技能检查完成，无需变更")
