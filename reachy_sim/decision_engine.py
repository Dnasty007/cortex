"""Choose local, Hermes, or Grok Bot for one utterance."""

from __future__ import annotations


class DecisionEngine:
    """Apply the first-version routing rule. No network calls."""

    def decide(self, sample: dict) -> str:
        """Return local, hermes, or grok_bot.

        A local skill on a slow link with no ethernet goes to Grok Bot.
        Any other local skill stays local. Everything else goes to Hermes.
        """
        local_match = bool(sample["local_skill_match"])
        rtt_ms = float(sample["network_rtt_ms"])
        ethernet_up = bool(sample["ethernet_up"])
        if local_match and rtt_ms > 150 and not ethernet_up:
            return "grok_bot"
        if local_match:
            return "local"
        return "hermes"
