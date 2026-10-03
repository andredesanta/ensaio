import { useValues } from 'kea'
import { router } from 'kea-router'
import { lazy, Suspense } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { scenes } from '../../products/feature_flags/manifest'
import { currentTeamId } from './config'
import { Button } from './lib/ui'

const FeatureFlags = lazy(async () => {
    const module = await scenes.featureFlags.load()
    return { default: module.FeatureFlags }
})
const FeatureFlag = lazy(async () => {
    const module = await scenes.featureFlag.load()
    return { default: module.FeatureFlag }
})
const TraceView = lazy(async () => {
    const module = await scenes.trace.load()
    return { default: module.TraceView }
})

function SceneBoundary({ children }: { children: ReactNode }): ReactElement {
    return (
        <Suspense
            fallback={
                <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">
                    Loading scene…
                </main>
            }
        >
            {children}
        </Suspense>
    )
}

function parseFlagId(value: string | undefined): number | null {
    if (value === undefined || !/^\d+$/.test(value)) {
        return null
    }
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function App(): ReactElement {
    const { location } = useValues(router)
    const pathname = location.pathname.replace(/\/+$/, '') || '/'
    const teamId = currentTeamId()

    if (pathname === '/' || pathname === '/feature_flags') {
        return (
            <SceneBoundary>
                <FeatureFlags teamId={teamId} />
            </SceneBoundary>
        )
    }
    if (pathname === '/feature_flags/new') {
        return (
            <SceneBoundary>
                <FeatureFlag teamId={teamId} flagId="new" />
            </SceneBoundary>
        )
    }

    const segments = pathname.split('/')
    const flagId = parseFlagId(segments[2])
    if (segments.length === 4 && segments[1] === 'feature_flags' && segments[3] === 'trace' && flagId !== null) {
        return (
            <SceneBoundary>
                <TraceView teamId={teamId} flagId={flagId} />
            </SceneBoundary>
        )
    }
    if (segments.length === 3 && segments[1] === 'feature_flags' && flagId !== null) {
        return (
            <SceneBoundary>
                <FeatureFlag teamId={teamId} flagId={flagId} />
            </SceneBoundary>
        )
    }

    return (
        <main className="grid min-h-screen place-items-center bg-slate-50 px-5">
            <div className="text-center">
                <p className="text-sm font-semibold text-fuchsia-700">404</p>
                <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
                <Button className="mt-5" variant="primary" onClick={() => router.actions.push('/feature_flags')}>
                    Open feature flags
                </Button>
            </div>
        </main>
    )
}
