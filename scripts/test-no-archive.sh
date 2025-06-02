#!/bin/zsh
# scripts/test-no-archive.sh
# Run all Jest tests except those in tests/archive

npx jest --testPathIgnorePatterns=tests/archive "$@"
