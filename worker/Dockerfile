FROM python:3.12-slim-bookworm AS base
WORKDIR /worker
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.11.21

FROM base AS dependencies
COPY pyproject.toml uv.lock /project/
RUN cd /project && uv sync --frozen --no-dev --no-install-project

FROM base AS test
WORKDIR /project
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --group test --no-install-project
COPY config ./config
COPY worker ./worker
RUN uv run pytest -q

FROM base AS worker
RUN groupadd --gid 1001 benchly \
    && useradd --uid 1001 --gid 1001 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin benchly
COPY --from=dependencies /project/.venv /project/.venv
ENV PATH="/project/.venv/bin:$PATH"
COPY config /config
COPY worker/benchly_worker.py ./benchly_worker.py
COPY worker/benchly ./benchly
COPY worker/evaluation ./evaluation
ENTRYPOINT ["python3", "/worker/benchly_worker.py"]
CMD ["refresh", "--database", "/data/benchly.sqlite"]
