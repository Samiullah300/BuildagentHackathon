#!/bin/sh
# Thin wrapper so the Agent37 agent (which can only run a fixed allowlist of
# commands) can call Monid tools: the sandbox blocks installs, but
# `npm run monid -- <args>` is allowed, and this script proxies to the
# globally installed `monid` CLI.
exec monid "$@"
