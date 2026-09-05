FROM python:3.12-slim-bookworm
WORKDIR /worker
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin libgdal-dev \
    && groupadd --gid 1001 benchly \
    && useradd --uid 1001 --gid 1001 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin benchly \
    && rm -rf /var/lib/apt/lists/*
COPY worker/requirements.txt ./requirements.txt
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY config /config
COPY worker/benchly_worker.py ./benchly_worker.py
COPY worker/benchly ./benchly
COPY worker/weather_pipeline.py ./weather_pipeline.py
COPY worker/transit_pipeline.py ./transit_pipeline.py
COPY worker/landscape_pipeline.py ./landscape_pipeline.py
COPY worker/visual_pipeline.py ./visual_pipeline.py
COPY worker/evaluation ./evaluation
ENTRYPOINT ["python3", "/worker/benchly_worker.py"]
CMD ["refresh", "--database", "/data/benchly.sqlite"]
