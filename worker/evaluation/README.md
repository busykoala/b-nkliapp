# Benchly vision evaluation

benchly-100.jsonl contains 100 manually reviewed Swiss locations across all seven required scene classes. Every record keeps its open-source URL, provider, licence and reviewed image hash. Image bytes are not committed.

Run the validator and model benchmark with:

    python worker/benchly_worker.py benchmark-vision --dataset worker/evaluation/benchly-100.jsonl --models benchly-vision general
