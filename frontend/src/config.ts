export function currentTeamId(): number {
    const configured = document.documentElement.dataset.teamId ?? '1'
    const teamId = Number(configured)
    if (!Number.isInteger(teamId) || teamId <= 0) {
        throw new Error(`Invalid team id: ${configured}`)
    }
    return teamId
}
