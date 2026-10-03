import { resetContext } from 'kea'
import { formsPlugin } from 'kea-forms'
import { loadersPlugin } from 'kea-loaders'
import { routerPlugin } from 'kea-router'
import { testUtilsPlugin } from 'kea-test-utils'

export function resetKeaTestContext(): void {
    resetContext({
        plugins: [
            testUtilsPlugin(),
            loadersPlugin({
                onFailure: () => undefined,
            }),
            formsPlugin(),
            routerPlugin({
                history: {
                    pushState: () => undefined,
                    replaceState: () => undefined,
                },
                location: {
                    pathname: '/feature_flags',
                    search: '',
                    hash: '',
                },
            }),
        ],
    })
}
