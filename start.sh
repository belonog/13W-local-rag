#!/bin/bash

export MEMORY_DEBUG_LOG=/tmp/local-rag-debug.log
truncate -s 0 ${MEMORY_DEBUG_LOG}

pnpm start
