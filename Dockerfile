FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (provides the uvx / "uv tool" commands used to run
# the AviationStack MCP server as a subprocess).
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Pre-install the AviationStack MCP tool at build time, pinned below
# mcp SDK 2.0.0 (see mcp_client.py for why: mcp 2.0.0 removed the
# mcp.server.fastmcp module that aviationstack-mcp still imports from).
# Baking this in at build time also avoids resolving/downloading the
# tool on every cold start in production.
RUN uv tool install aviationstack-mcp --with "mcp[cli]<2"
ENV PATH="/root/.local/bin:${PATH}"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]