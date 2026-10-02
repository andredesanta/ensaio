import ensaio_kernel


def test_kernel_imports_as_its_own_package() -> None:
    """Local evaluation imports this package directly, not through Django.

    If packaging breaks and ``ensaio_kernel`` is only reachable as a Django app,
    collection of this test fails, and a consumer that fetched
    ``/flags/definitions`` cannot evaluate in-process with the same code the
    server uses.
    """
    assert ensaio_kernel.__name__ == "ensaio_kernel"
