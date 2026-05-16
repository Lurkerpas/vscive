#!/bin/bash

set -euo pipefail

PROJECT_DIR=$(pwd -P)
PROJECT_NAME_SOURCE=${TASTE_HOST_PWD:-${PROJECT_DIR}}
PROJECT_NAME=$(basename "${PROJECT_NAME_SOURCE}")
SCRATCH_PARENT=

cleanup() {
    if [ -n "${SCRATCH_PARENT}" ] && [ -d "${SCRATCH_PARENT}" ] ; then
        rm -rf "${SCRATCH_PARENT}"
    fi
}

trap cleanup EXIT

if ! command -v taste >/dev/null 2>&1 ; then
    echo "[x] 'taste' is not available in PATH. Aborting..."
    exit 1
fi

if [[ ! "${PROJECT_NAME}" =~ ^[A-Za-z].* ]] ; then
    echo "[x] Invalid project name '${PROJECT_NAME}'. The directory name must start with a letter."
    exit 1
fi

GENERATED_PATHS=(
    "${PROJECT_NAME}.acn"
    "${PROJECT_NAME}.asn"
    "${PROJECT_NAME}.msc"
    "${PROJECT_NAME}.pro"
    "${PROJECT_NAME}.pro.user"
    "DataView.aadl"
    "Makefile"
    "Makefile.modelcheck"
    "interfaceview.xml"
    "work"
)

for path in "${GENERATED_PATHS[@]}" ; do
    if [ -e "${PROJECT_DIR}/${path}" ] ; then
        echo "[x] Refusing to overwrite existing path: ${path}"
        exit 1
    fi
done

SCRATCH_PARENT=$(mktemp -d)

(
    cd "${SCRATCH_PARENT}"
    taste init "${PROJECT_NAME}"
)

SCRATCH_PROJECT="${SCRATCH_PARENT}/${PROJECT_NAME}"

if [ ! -d "${SCRATCH_PROJECT}" ] ; then
    echo "[x] Project generation failed: ${SCRATCH_PROJECT} was not created."
    exit 1
fi

while IFS= read -r -d '' entry ; do
    mv "${entry}" "${PROJECT_DIR}/"
done < <(find "${SCRATCH_PROJECT}" -mindepth 1 -maxdepth 1 -print0)

echo "[-] Initialized TASTE project '${PROJECT_NAME}' in ${PROJECT_DIR}"