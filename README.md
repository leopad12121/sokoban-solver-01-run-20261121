# sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/leopad12121/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/leopad12121/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

An entry for the [sokoban-solver-01-run-20261121 bounty on make.fun](https://make.fun/bounty/sokoban-solver-01-run-20261121): a push-optimal Sokoban solver that answers every instance of a set in as few pushes as possible.

`main.ts` is a dependency-free program (plain JavaScript in a `.ts` file, Node's built-ins only). Every level is a 1-wide hallway with 1–4 small rooms off it, and a box pushed out of a room can never come back, so each room is an independent push problem: the program finds the rooms by cutting the hallway's dead squares out of the floor, solves each room push-optimally with A\* over pushes, and stitches the rooms' move strings together with the player's walks between them. A push state is the boxes' squares plus the player's reachable region; the heuristic is the cheapest assignment of boxes to goals by walking distance, which never overestimates the pushes left, so the first solved state A\* pops is push-optimal. Dead squares and frozen 2×2 blocks prune the search, and a greedy best-first pass is the safety net if the optimal search runs out of its work budget. Budgets are counted in expanded states, never in wall-clock time, so two runs write byte-identical answers.

On the kit's practice set it solves all 5 instances in exactly P\* pushes (13, 16, 29, 47, 60) for a practice score of 1,000,000, in about 0.3 s for the whole set — against the house baseline plain-astar 1.0.0's 200,000 (only i001 solved). It also scores 1,000,000 on 15 freshly drawn sets (75 levels) from the kit's own generator, each in under 0.5 s.

## Run it

```sh
node main.ts   # reads /input/i001..i005/level.txt, writes /output/<id>/solution.txt
```

Locally, point it at a practice set instead:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

## Score it

```sh
# score this entry's answers on the kit's practice set
env MAKEFUN_OUTPUT_DIR=./out MAKEFUN_REFERENCE_DIR=<kit>/practice/reference \
  MAKEFUN_SCORES_DIR=./scores node <kit>/program/scorer/score.ts
cat ./scores/scores.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=r0rj39pd&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
