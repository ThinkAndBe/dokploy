FROM docker:27.5.1-cli AS cli
FROM python:3.12-slim-bookworm
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
WORKDIR /opt/apphub
COPY worker.py ./worker.py
ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python","/opt/apphub/worker.py"]
