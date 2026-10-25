import { join } from 'node:path'
import { getPaths } from '../paths'
import { MarketspaceService } from './service'

let instance: MarketspaceService | null = null

/** Native, in-process Marketspace; no daemon or compatibility CLI required. */
export function getMarketspace(): MarketspaceService {
  instance ??= new MarketspaceService(join(getPaths().root, 'marketspace'))
  return instance
}

export { MarketspaceService } from './service'
