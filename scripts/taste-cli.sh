#!/bin/bash

set -euo pipefail

IMAGE="${TASTE_DOCKER_IMAGE:-gitlab.esa.int:4567/taste/taste-setup:feature-trixie}"
CONTAINER_HOME=/home/taste
WORKDIR=$(pwd -P)
HOST_UID=${SUDO_UID:-$(id -u)}
HOST_GID=${SUDO_GID:-$(id -g)}
DOCKER_CMD=(docker)

if ! command -v docker >/dev/null 2>&1 ; then
    echo "[x] You don't have Docker installed. Aborting..."
    exit 1
fi

if [ "$(id -u)" -ne 0 ] ; then
    if ! command -v sudo >/dev/null 2>&1 ; then
        echo "[x] You don't have sudo installed. Aborting..."
        exit 1
    fi
    DOCKER_CMD=(sudo docker)
fi

tty_args=()
if [ -t 0 ] && [ -t 1 ] ; then
    tty_args=(-it)
else
    tty_args=(-i)
fi

"${DOCKER_CMD[@]}" run \
    --rm \
    "${tty_args[@]}" \
    --user "${HOST_UID}:${HOST_GID}" \
    -e APPIMAGE_EXTRACT_AND_RUN=1 \
    -e HOME=/tmp/taste-home \
    -e PYTHONUSERBASE=${CONTAINER_HOME}/.local \
    -e USER=taste \
    -e LOGNAME=taste \
    -e TASTE_IN_DOCKER=1 \
    -v "${WORKDIR}:${CONTAINER_HOME}/work" \
    -w "${CONTAINER_HOME}/work" \
    "${IMAGE}" \
    bash -lc '
        mkdir -p "$HOME"
        export PS1="taste-cli:\w\\$ "
        export TASTE_IN_DOCKER=1
        export QT_QPA_PLATFORM=offscreen
        export PYTHONUSERBASE=/home/taste/.local
        [ -f /home/taste/.bashrc.taste ] && . /home/taste/.bashrc.taste
        if [ "$#" -eq 0 ] ; then
            exec bash -i
        fi
        exec "$@"
    ' bash "$@"