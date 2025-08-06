FROM debian:11.7
RUN apt-get clean
RUN apt-get update --fix-missing
RUN apt-get update

RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    unzip

WORKDIR /app

RUN curl -LsSf https://astral.sh/uv/install.sh | sh