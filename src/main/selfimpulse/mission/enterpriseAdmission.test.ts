import { describe, expect, it } from 'vitest'
import { authorizeEnterpriseMission, setEnterpriseMissionAuthorizer } from './enterpriseAdmission'

describe('enterprise mission admission boundary', () => {
  it('uses the registered native authorizer and propagates refusals before execution', async () => {
    const request = {
      missionId: 'm-1',
      teamId: 'team.alpha',
      seats: [{ id: 'researcher', name: 'Researcher' }]
    }
    setEnterpriseMissionAuthorizer(async (received) => {
      expect(received).toEqual(request)
      throw new Error('Restriction denied mission.run')
    })
    await expect(authorizeEnterpriseMission(request)).rejects.toThrow('Restriction denied mission.run')
    setEnterpriseMissionAuthorizer(async () => undefined)
    await expect(authorizeEnterpriseMission(request)).resolves.toBeUndefined()
  })
})
