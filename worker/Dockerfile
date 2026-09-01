FROM python:3.12-slim-bookworm
WORKDIR /worker
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp
RUN apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*
COPY worker/requirements.txt ./requirements.txt
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY worker/benchly_worker.py ./benchly_worker.py
ENTRYPOINT ["python3", "/worker/benchly_worker.py"]
CMD ["refresh", "--database", "/data/benchly.sqlite"]
