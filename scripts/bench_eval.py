"""Small, reproducible microbenchmark for Ensaio's pure evaluation path."""

import argparse
import platform
import statistics
from collections.abc import Callable
from dataclasses import dataclass
from time import perf_counter_ns

from ensaio_kernel import FlagDefinition, evaluate, hash_position


@dataclass(frozen=True, slots=True)
class Benchmark:
    name: str
    operation: Callable[[int], object]


@dataclass(frozen=True, slots=True)
class Result:
    name: str
    median_ns: float
    minimum_ns: float
    maximum_ns: float

    @property
    def median_per_second(self) -> float:
        return 1_000_000_000 / self.median_ns


IDENTIFIERS = tuple(f"benchmark-subject-{index}" for index in range(1024))
PROPERTIES: dict[str, object] = {"country": "BR", "plan": "pro"}

BOOLEAN_FLAG = FlagDefinition(
    key="benchmark-boolean",
    active=True,
    filters={"groups": [{"properties": [], "rollout_percentage": 100, "variant": None}]},
    version=1,
)

MULTIVARIATE_FLAG = FlagDefinition(
    key="benchmark-multivariate",
    active=True,
    filters={
        "groups": [
            {
                "properties": [
                    {
                        "key": "country",
                        "type": "person",
                        "operator": "exact",
                        "value": ["BR"],
                    }
                ],
                "rollout_percentage": 75,
                "variant": None,
            }
        ],
        "multivariate": {
            "variants": [
                {"key": "control", "rollout_percentage": 50},
                {"key": "test", "rollout_percentage": 50},
            ]
        },
        "payloads": {"test": {"layout": "v2"}},
    },
    version=1,
)


def _identifier(index: int) -> str:
    return IDENTIFIERS[index % len(IDENTIFIERS)]


def _hash(index: int) -> float:
    return hash_position("benchmark-flag", _identifier(index))


def _boolean(index: int) -> object:
    return evaluate(BOOLEAN_FLAG, _identifier(index), PROPERTIES)


def _multivariate(index: int) -> object:
    return evaluate(MULTIVARIATE_FLAG, _identifier(index), PROPERTIES)


BENCHMARKS = (
    Benchmark("hash_position", _hash),
    Benchmark("evaluate_boolean_100_percent", _boolean),
    Benchmark("evaluate_targeted_multivariate", _multivariate),
)


def run_benchmark(benchmark: Benchmark, *, iterations: int, rounds: int, warmup: int) -> Result:
    for index in range(warmup):
        benchmark.operation(index)

    samples: list[float] = []
    for round_index in range(rounds):
        started_at = perf_counter_ns()
        for index in range(iterations):
            benchmark.operation(index + round_index)
        elapsed = perf_counter_ns() - started_at
        samples.append(elapsed / iterations)

    return Result(
        name=benchmark.name,
        median_ns=statistics.median(samples),
        minimum_ns=min(samples),
        maximum_ns=max(samples),
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=100_000)
    parser.add_argument("--rounds", type=int, default=7)
    parser.add_argument("--warmup", type=int, default=10_000)
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.iterations < 1 or args.rounds < 1 or args.warmup < 0:
        raise SystemExit("iterations and rounds must be positive; warmup must be non-negative")

    results = [
        run_benchmark(
            benchmark,
            iterations=args.iterations,
            rounds=args.rounds,
            warmup=args.warmup,
        )
        for benchmark in BENCHMARKS
    ]

    print(f"Python {platform.python_version()} | {platform.platform()} | {platform.machine()}")
    print(f"{args.rounds} rounds × {args.iterations:,} iterations; {args.warmup:,} warmup iterations")
    print()
    print("| Operation | Median µs/op | Median ops/s | Min–max µs/op |")
    print("| --- | ---: | ---: | ---: |")
    for result in results:
        print(
            f"| `{result.name}` | {result.median_ns / 1_000:.3f} | "
            f"{result.median_per_second:,.0f} | "
            f"{result.minimum_ns / 1_000:.3f}–{result.maximum_ns / 1_000:.3f} |"
        )


if __name__ == "__main__":
    main()
