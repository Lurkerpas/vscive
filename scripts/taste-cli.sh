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
        diagnose_missing_toolchains() {
            local gpr_files required available missing compiler_dir driver

            gpr_files=$(find . -path "*/work/build/*" -name "*.gpr" 2>/dev/null) || return 0
            [ -n "$gpr_files" ] || return 0

            required=$(grep -hE "for Driver \(\"(C|Ada|C\+\+)\"\) use \"[^\"]+\";" $gpr_files 2>/dev/null \
                | sed -E "s/.* use \"([^\"]+)\";.*/\1/" \
                | sort -u) || return 0
            [ -n "$required" ] || return 0

            missing=""
            for driver in $required; do
                if ! command -v "$driver" >/dev/null 2>&1; then
                    missing="$missing $driver"
                fi
            done

            missing=${missing# }
            [ -n "$missing" ] || return 0

            available=$(find /opt -path "*/bin/*-gcc" -type f 2>/dev/null \
                | xargs -r -n1 basename \
                | sort -u \
                | tr "\n" " ")
            available=${available%% }

            echo >&2
            echo "[x] The selected TASTE image does not provide the compiler(s) required by this project." >&2
            echo "    Image: ${IMAGE}" >&2
            echo "    Required: ${missing}" >&2
            if [ -n "$available" ]; then
                echo "    Available in image: ${available}" >&2
            else
                echo "    No *-gcc cross-compilers were found under /opt/*/bin in the image." >&2
            fi
            echo "    The generated build files determine the required compiler family for the project." >&2
            echo "    For example, SAMV71 RTEMS projects need an image that provides arm-rtems6-gcc." >&2
        }

        mkdir -p "$HOME"
        ln -sfn /home/taste/tool-inst "$HOME/tool-inst"
        export PS1="taste-cli:\w\\$ "
        export TASTE_IN_DOCKER=1
        export QT_QPA_PLATFORM=offscreen
        export PYTHONUSERBASE=/home/taste/.local
        [ -f /home/taste/.bashrc.taste ] && . /home/taste/.bashrc.taste
        for compiler_dir in /opt/*/bin; do
            [ -d "$compiler_dir" ] || continue
            case ":$PATH:" in
                *":$compiler_dir:"*) ;;
                *) PATH="$compiler_dir:$PATH" ;;
            esac
        done
        export PATH
        if [ "$#" -eq 0 ] ; then
            exec bash -i
        fi
        "$@"
        status=$?
        if [ "$status" -ne 0 ] ; then
            diagnose_missing_toolchains
        fi
        exit "$status"
    ' bash "$@"