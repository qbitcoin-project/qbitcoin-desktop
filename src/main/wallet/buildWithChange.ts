import { toHex } from '@qbtc/crypto'
import { addressFromScripthash, decodeAddress } from '../brand/crypto'
import type { ChangeBranch, UnsignedTx } from './buildTx'

/** Price and select inputs before requesting wallet addresses. These builders
 * put the recipient first and change afterwards. Temporary hashes stay inside
 * this function; only fully resolved outputs can reach a preview or signer. */
export async function buildWithChange<T extends { readonly unsigned: UnsignedTx }>(
  recipient: string,
  build: (addressFor: (algo: ChangeBranch) => string) => T,
  getAddress: (algo: ChangeBranch) => Promise<string>,
): Promise<{ built: T; addresses: Partial<Record<ChangeBranch, string>> }> {
  const { network } = decodeAddress(recipient)
  const shapes = { ecdsa: new Uint8Array(20), falcon512: new Uint8Array(32) }
  const shapeAddresses = {
    ecdsa: addressFromScripthash(shapes.ecdsa, network),
    falcon512: addressFromScripthash(shapes.falcon512, network),
  }
  const planned = build((algo) => shapeAddresses[algo])
  const changes = planned.unsigned.outputs.slice(1).map((output, offset) => {
    const algo = (Object.keys(shapes) as ChangeBranch[]).find((a) => toHex(shapes[a]) === output.scripthash)
    if (algo === undefined) throw new Error('Unexpected change output in the transaction plan.')
    return { index: offset + 1, algo }
  })
  const addresses: Partial<Record<ChangeBranch, string>> = {}
  const hashes = new Map<ChangeBranch, string>()
  for (const algo of new Set(changes.map((change) => change.algo))) {
    const address = await getAddress(algo)
    const decoded = decodeAddress(address)
    // Replacing a hash with one of the same size preserves the selected inputs,
    // amounts and fee. Reject a provider returning another network or branch.
    if (decoded.network !== network || decoded.scripthash.length !== shapes[algo].length) {
      throw new Error('The change address does not match the requested network and algorithm.')
    }
    addresses[algo] = address
    hashes.set(algo, toHex(decoded.scripthash))
  }
  const outputs = [...planned.unsigned.outputs]
  for (const { index, algo } of changes) outputs[index] = { ...outputs[index]!, scripthash: hashes.get(algo)! }
  return { built: { ...planned, unsigned: { ...planned.unsigned, outputs } }, addresses }
}
