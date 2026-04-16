FROM python:3.13-slim-bookworm

ARG HERMES_VERSION=0.9.0
ARG IMAGE_VERSION=v0.9.0
ARG PIP_INDEX_URL=""
ARG PIP_TRUSTED_HOST=""
ARG APT_MIRROR=""

ENV PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    HERMES_HOME=/root/.hermes \
    HERMES_GATEWAY_PORT=18791

RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gettext-base && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "hermes-agent==${HERMES_VERSION}"

COPY config.yaml.template /opt/hermes/config.yaml.template
COPY docker-entrypoint.sh /opt/hermes/docker-entrypoint.sh
RUN chmod +x /opt/hermes/docker-entrypoint.sh

RUN echo "${IMAGE_VERSION}" > /opt/hermes/.hermes-version

EXPOSE 18791
WORKDIR /opt/hermes

ENTRYPOINT ["/opt/hermes/docker-entrypoint.sh"]
CMD ["hermes", "gateway", "setup", "--all", "--non-interactive"]
