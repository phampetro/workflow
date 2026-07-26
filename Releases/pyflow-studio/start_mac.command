#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
export PYFLOW_LICENSE_ENFORCE=1

# Kill port 8000
lsof -i :8000 | awk 'NR!=1 {print $2}' | xargs -r kill -9

cd "$DIR/backend"
./pyflow-backend &
sleep 3
open http://localhost:8000
