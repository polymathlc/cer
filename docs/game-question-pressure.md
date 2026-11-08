# Escalating wrong-answer consequences — v1.457.0

Every question-driven game uses the same run-local policy in
`game-question-pressure.js`. Successive wrong answers remove 8%, 16%, 28%, then
45% of maximum health, rounded up to at least one health point. The fifth wrong
answer forces the normal defeat path even if the player healed between answers.
Combat armor, block, shields and invulnerability do not absorb question penalties.
Ordinary damage can end a run before the fifth miss.

A correct graded answer resets the wrong-answer streak. A genuinely new run
starts a new streak. A resumed run keeps its streak where the game supports saves.
These counters are separate from student mastery, question history and account
reward calculations. Only final grades count; unavailable questions, network
errors, cancelled grading and duplicate/stale callbacks do not add a miss.

| Question-driven game or mode | Consequence target |
| --- | --- |
| Science Defenders | Base lives |
| Science Raiders | Player health |
| Science Spire | Hero health, bypassing card block |
| Science Legends | Hero health; wrong answers no longer heal |
| Science Slayers | Hero health; wrong answers no longer heal |
| Science Strike | Player health |
| Hades Sanctuary | Hero health, from each verified answer in the five-question round |
| Crew Defense / Grand Line | Ship life, from each verified answer in the three-question round |
| Realm of Embers Training | Session focus; depletion ends training without removing earned card levels |
| Ember Duel | Player hero health; the fifth miss forfeits the duel |
| Ember Siege | Gate health |
| Ember Legends | Player health |

Pirate Rift, the original Adventure/Ghost Arena, and the automatic TCG Battle
Arena/Infinite Dungeon have no question-answer loop. There is no wrong-answer
streak in those games. Ordinary school practice keeps its existing grading and
rewards.

Players see the rule before answering, the current streak and penalty after a
wrong answer, a warning before the fifth miss, and a reset notice after a correct
answer. Defeat guards stop stale Continue buttons, wave/room launches, delayed
healing, and incomplete-round rewards from restarting a defeated run. Hades and
Grand Line preserve verified per-question ordering rather than inferring a
consecutive streak from an aggregate round score.

Validation includes the shared policy's escalation/reset/terminal behavior plus
production-game regressions for real health loss, defense bypass, fifth-miss
defeat despite health refills, new-run reset and duplicate/continuation guards.
