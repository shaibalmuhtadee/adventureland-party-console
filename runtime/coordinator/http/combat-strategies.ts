import { isStrategyId, strategiesFor, type CharacterStrategies } from '../../combat/strategies.ts';
import { requestObject, type HttpRequest, type HttpResponse } from './contracts.ts';

export function createCombatStrategiesRoute(state: { combatStrategies: CharacterStrategies }, ports: {
  owned(name: string): { ctype?: string; type?: string } | null | undefined;
  persist(): void;
}) {
  return (req: HttpRequest, res: HttpResponse) => {
    const body = requestObject(req.body);
    const character = typeof body.character === 'string' ? ports.owned(body.character) : null;
    if (!character || typeof body.character !== 'string')
      return res.status(400).json({ error: 'Unknown character' });
    if (!isStrategyId(body.strategy) || typeof body.enabled !== 'boolean' ||
        !strategiesFor(character.ctype || character.type || '').some(strategy => strategy.id === body.strategy))
      return res.status(400).json({ error: 'Invalid strategy for this class' });
    state.combatStrategies[body.character] = { ...state.combatStrategies[body.character], [body.strategy]: body.enabled };
    ports.persist();
    return res.json({ ok: true });
  };
}
