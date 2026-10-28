# Cortex

You get a new folder that a new agent opens. Keys and chats stay in the original folder. Nothing starts itself.

Hermes, Claude, Cursor, and Codex each keep their own file names. The new agent reads a Cortex note in the file it already loads.

## Price

$0.99 once.

[Pay $0.99 with PayPal](https://www.paypal.me/RLC007/0.99USD)

## If you already use an AI

Paste that AI's folder, then press Build and Birth. Cortex downloads its brain into a new folder. Keys, chats, and jobs stay in the original folder.

Point your other AIs at the new folder. The file they already open tells them to read GROW.md, then the notes listed in growth/kept.md. While Cortex is open on this PC, they can download that same brain from `GET /api/shared-brain/download?path=` the folder, and read one file from `GET /api/shared-brain?path=` the folder `&file=` the file. They can leave a note in growth/pending/. You accept or reject that note in Cortex. An accepted note stays in growth/accepted/ and its name is added to growth/kept.md. The brain grows. The original AI is not changed. Nothing starts itself.

## What you need

- Windows
- Node.js
- Python 3

## Run

```bat
npm install
npm run dev
```

Open http://localhost:5173

`start.bat` does the same thing. If a Hermes home is already on this PC, it scans `%LOCALAPPDATA%\hermes` into a local file and then opens the page. That scan stays on your PC.

## The buttons

**Build** copies skills and rules into a pack on this PC. The original folder is not changed.

**Birth** writes that pack into a new empty folder. Nothing starts. Do not paste the new folder into the agent that is already open.

**Place** writes into an empty folder you already have. The first press shows the list. The second press writes. A live agent folder is refused, and so is a folder inside one or next to one.

**Check** reads the packing list and writes nothing.

**Compare** names skills that match, differ, or sit on only one side. It does not merge the folders and it does not copy skill text.

## What stays behind

Keys, chats, jobs, and config stay in the original folder. Phone numbers, email addresses, and secret-shaped lines are stripped from the copy. Each skill copy is only `SKILL.md`. Files beside a skill stay behind. If a task needs one of those, stop and ask.

Nothing in the new folder stops a send, a push, or a delete. The note tells the agent to stop and ask a person first.

## The picture

The picture reviews a Hermes folder. It is not the move. Drag to turn it.

The page looks for `public/brain-model.glb`. If that file is absent, it draws a simple shape. Do not publish `public/brain.*.json`. A scan can contain names from the folder you pointed it at.

A server scan is optional. Put `user@host` on the first line of `.hermes-host`. That file is not part of this repo.

## License

Copyright Ray. All rights reserved. See [LICENSE](LICENSE).
