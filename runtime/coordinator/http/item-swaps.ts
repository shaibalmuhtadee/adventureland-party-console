import { requestObject, type HttpRequest, type HttpResponse } from './contracts.ts';
import { validItemSwaps, swapIdentity, type ItemSwaps } from '../../item-swaps.ts';

export function createItemSwapsRoute(state: { itemSwaps: ItemSwaps }, ports: {
  owned(name: unknown): unknown; persist(): void;
}) {
  return (req: HttpRequest, res: HttpResponse) => {
    const body = requestObject(req.body);
    if (typeof body.character !== 'string' || !ports.owned(body.character))
      return res.status(400).json({ error: 'Unknown character' });
    if (!validItemSwaps(body.swaps)) return res.status(400).json({ error: 'Invalid inventory swaps' });
    state.itemSwaps[body.character] = body.swaps.map(swap => ({ ...swap,
      items: swap.items.map(selection => ({ ...selection, item: swapIdentity(selection.item) })) }));
    ports.persist();
    return res.json({ ok: true });
  };
}
