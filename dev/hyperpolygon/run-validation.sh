#!/bin/bash
# Copies the live solver into the dev folder (Node needs it next to the
# harness) and runs the validation suites.
set -e
cd "$(dirname "$0")"
cp ../../assets/js/hyperpolygon/solver.js ./solver.js
node sweep.mjs
node edge.mjs
node validate.mjs