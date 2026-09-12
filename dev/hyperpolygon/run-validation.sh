#!/bin/bash
# Copies the live solver into the dev folder (Node needs it next to the
# harness) and runs the validation suites.
set -e
cd "$(dirname "$0")"
cp ../../assets/js/hyperpolygon/solver.js ./solver.js
cp ../../assets/js/hyperpolygon/orientation.js ./orientation.js
cp ../../assets/js/hyperpolygon/chambers.js ./chambers.js
node sweep.mjs
node walls.mjs
node edge.mjs
node orient.mjs
node validate.mjs