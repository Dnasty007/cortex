# Cortex security boundary

This note is the rule for the public format repo and for a local runtime. These files do not start a process, open a socket, or open a tunnel.

## Public format repo

The public repository is the format layer: the spec, the packers, the boot check, brain-query, and CI. That layer has no SSH client and no headset. It does not ship a host, a key, or a token.

## Local runtime

A local runtime, if one is present, talks to Hermes only through a PC-side pipe. The SSH key stays in the user profile on that PC. The headset and the browser page receive JSON and audio. They never receive the key file, and they never receive a shell.

## No extra gateway

A sanitized example elsewhere puts many profile APIs behind one multiplexed loopback gateway. Cortex does not take that shape. Collapsing an existing reverse tunnel into a new daemon would add a process beside the one Cortex server. These files do not add that process, and they do not change a tunnel that a person already opened.

The reduction that fits this repo is: bind only to loopback, keep secrets in the environment, scrub logs, and keep this rule written down. The headset never receives the SSH key or a root shell.

## Bind and tunnel

Bind addresses are `127.0.0.1` only. `localhost` names that same machine. `0.0.0.0`, an empty host, and every other host fail a loopback check. In the local runtime that check is `assertLoopback` in `src/loopback-gate.js`. That function does not open a socket. This format repo does not include that file.

A reverse tunnel, if a person opens one, is a separate choice. It is not started by these files.

## Secrets

Secrets are environment variables named in [docs/env.example](docs/env.example). Copy those names into an untracked `.env` if a local runtime needs them. `.env` is never committed. Tracked files keep secret values empty. Do not invent a real host, address, key, or token.

`publicEnv()` returns `CORTEX_HOST` and `CORTEX_PORT` only. The host is forced through `assertLoopback`, and it defaults to `127.0.0.1` with port `5173`. `publicEnv()` does not return `HERMES_SSH_HOST`, `HERMES_SSH_USER`, or `XAI_API_KEY`.

## Logs

Logs drop `sk-` tokens (`sk-` plus eight or more characters), Bearer tokens, and email addresses. `sanitizeLog` removes those and caps a line at 400 characters.
