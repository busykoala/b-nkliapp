# Benchly vision evaluation

benchly-100.jsonl contains 100 manually reviewed locations in Valais, Geneva and Bern across all seven required scene classes. It is a regression fixture, not evidence of nationwide or elevation-stratified performance. Every record keeps its open-source URL, provider, licence and reviewed image hash. Image bytes are not committed.

Shared imagery and nearby coordinate groups stay in one partition. Roughly one third is reserved for held-out calibration so that the calibration partition can reach the 30-sample minimum; a model cannot pass the benchmark when calibration remains unavailable for any reported label.

Run the validator and model benchmark with:

    uv run python worker/benchly_worker.py benchmark-vision --dataset worker/evaluation/benchly-100.jsonl --models benchly-vision general

Build the worker's test target to run the tests in the same Linux/GDAL base as production:

    npm run test:worker:container

The reviewed scene fixture remains because it guards the production vision
pipeline. Temporary model weights, database indexes and experiment reports are
not part of the repository.

The original benchmark and the later 26-canton SWISSIMAGE countercheck did not
justify replacing direct geographic evidence. The nationwide sample, downloaded
image bytes and one-off training code were deleted after the decision; they are
not a second production pipeline.
