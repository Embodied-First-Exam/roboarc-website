#!/bin/sh
# usage: scripts/topogym/run.sh <TopoGym checkout> <output folder> <script.py>
# Runs one export script in the TopoGym image: CPU only, no network, the checkout read-only at /WT, output in /out.
# The soft exports (export_knot/threading/blanket.py) and export_rigid.py write the folders that
# scripts/export_soft.py and scripts/export_rigid.py turn into the site's puzzle files.
set -e
mkdir -p "$2"
exec docker run --rm --network none --memory 3g --cpus 2 --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$(realpath "$1")":/WT:ro -v "$(realpath "$2")":/out -v "$(cd "$(dirname "$0")" && pwd)":/scripts:ro \
  ghcr.io/luigivamper/rcb-topogym:0.2.3-cu128 python "/scripts/$3"
