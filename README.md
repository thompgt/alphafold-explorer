# AlphaFold Explorer

A local-first protein structure workbench: it ingests [AlphaFold DB](https://alphafold.ebi.ac.uk)
predicted structures, extracts per-residue confidence (pLDDT) into **DuckDB**, and layers three
**local LLM** features on top of that shared core.

| Feature | What it does |
| --- | --- |
| **Ask** | Plain-English question → guarded DuckDB `SELECT` → table + LLM summary. The generated SQL is always shown. |
| **Annotate** | Batch worker writes a structured annotation card per protein back into DuckDB. |
| **Recall** | Annotation cards + UniProt text embedded into DuckDB (VSS/HNSW), answered with citations. |

Everything runs offline against a local [Ollama](https://ollama.com) install — no API keys.

## Stack

Node 22 · TypeScript (ESM) · DuckDB (`@duckdb/node-api`, `vss`) · Fastify · React + Vite + Mol\* ·
Ollama · MinIO · Docker Compose · Vitest

## Layout

```
packages/core     schema, migrations, DuckDB access, SQL guard
packages/ingest   AlphaFold fetch, mmCIF pLDDT parser, feature extraction, workers
packages/llm      provider interface, Ollama chat/embeddings, prompts
apps/api          Fastify HTTP API
apps/web          React UI with Mol* 3D viewer
```

## Status

Under construction — see `docs/` and the commit history for progress.
