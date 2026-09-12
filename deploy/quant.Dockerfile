FROM python:3.12-slim AS build
WORKDIR /app
RUN pip install --no-cache-dir uv==0.11.24
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim
WORKDIR /app
ENV PATH="/opt/venv/bin:$PATH" PYTHONPATH=/app/services/quant PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
COPY --from=build /opt/venv /opt/venv
COPY services/quant/quant services/quant/quant
RUN useradd --create-home --uid 10001 quant && mkdir /artifacts && chown quant:quant /artifacts
USER quant
ENV ARTIFACT_ROOT=/artifacts
EXPOSE 8000
CMD ["uvicorn", "quant.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "8", "--timeout-keep-alive", "5"]
