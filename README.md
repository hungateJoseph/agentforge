# AgentForge

A small app you run on your own computer. Tell it which accounts you already have (Anthropic, OpenAI, Twilio, AgentMail, Amazon, Instacart, Fiverr, TaskRabbit, AWS, Stripe, Slack, GitHub, Gmail), paste in the keys you have, and it tells you what those accounts can do together as an agent, what cannot be done with a key at all, and which orchestrator (n8n, MCP servers, Composio, plain code, Zapier) covers the most of your set.

Keys are written to a `.env` file on your machine and never uploaded. The app only reaches the internet when you ask it to: to test a key with a single read-only request, or to look on GitHub for community MCP servers and n8n nodes for a service.

## Run it

Needs Node 20 or newer.

```sh
git clone https://github.com/hungateJoseph/agentforge.git
cd agentforge
npm start
```

That opens `http://127.0.0.1:4177/` in your browser. Or, without cloning:

```sh
npx github:hungateJoseph/agentforge
```

Options:

```
agentforge [--port 4177] [--env ./.env] [--no-open]
```

By default keys go to `.env` in the directory you started from. Point `--env` somewhere else to keep them with a project.

## What it does

1. **Pick accounts.** Every service shows whether it has a public API you can use with your own key, a partner-only API, a partial one, or none at all.
2. **Add keys.** A dialog per service, with a link to where the key comes from. Values are saved to the `.env` file with the usual variable names (`ANTHROPIC_API_KEY`, `TWILIO_AUTH_TOKEN`, and so on), so other tools can read the same file. Where a service has a safe read-only endpoint, **Test** checks the key works.
3. **See your setup.** For the accounts you ticked:
   - whether an agent can drive each one directly, and what to do when it cannot (Amazon has no buyer API, Fiverr has no API, TaskRabbit needs a partner key, Instacart stops before checkout);
   - what you can build with the combination, and whether it is ready or needs a missing piece;
   - a ranking of orchestrators by how many of your accounts they connect without custom code.
4. **Find integrations.** Searches GitHub for MCP servers and n8n community nodes for any service.
5. **Build Network.** Your accounts appear as nodes on a canvas. Drag from the dot on one to another to propose a bridge, say Twilio to AWS. While you drag, the target shows whether that bridge is possible (directly, through an orchestrator, only up to a point, only with a partner key, only as a human step, or not at all), how it would be done, and whether each end has a key saved and tested. Bridges you drop are listed with the details, and a summary says which single tool could carry all of them.
6. **Save as Markdown** to keep the plan.

## Adding or correcting a service

Everything the app knows lives in `src/catalog.js`: the services, their keys, where to get them, what they can and cannot do, and which orchestrators cover them. Edit that file and run `npm test`.

## Tests

```sh
npm test
```

## License

MIT
