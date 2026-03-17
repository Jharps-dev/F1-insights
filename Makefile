SHELL := /bin/bash

.PHONY: doctor lint typecheck test test-replay build dev ship-dev release clean

doctor:
	pnpm --version
	git --version

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

test-replay:
	pnpm test:replay

build:
	pnpm build

dev:
	pnpm dev:web

ship-dev:
	pwsh ./tools/release/ship.ps1 -TargetBranch dev

release:
	pwsh ./tools/release/release.ps1

clean:
	rm -rf node_modules .turbo dist build coverage
