import type { ReactElement } from 'react'

/** Empty shell. Scenes land in M3. The class is here so Tailwind is actually in the build. */
export function App(): ReactElement {
    return <main className="min-h-screen bg-white" />
}
