/**
 * Display-only GraphQL query builders for the ElectroSwap indexer.
 *
 * Pure string builders: the client (ElectroSwapClient.query) runs the returned
 * string. Optional parameters are embedded directly in the query arguments
 * (string-literal form) so the builders stay dependency-free; addresses are
 * lowercased to the EVM canonical query form the indexer expects.
 */

/** Escape a string literal for embedding in a GraphQL string. */
function gqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Yield farms (farms the user can see); optionally scoped to one farmer. */
export function yieldFarmsQuery(farmer?: string): string {
  const arg = farmer ? `where: { farmer: ${gqlString(farmer.toLowerCase())} }` : ''
  return `
    query yieldFarms {
      yieldFarms(${arg}) {
        id
        name
        symbol
        chain
        token
        apy
        tvl
        rewards {
          id
          token
          amount
        }
        farmer
        createdAt
      }
    }`.replace(/\s+/g, ' ').trim()
}

/** Launchpad presale pools; optionally scoped to one pool address. */
export function presalesQuery(pool?: string): string {
  const arg = pool ? `where: { pool: ${gqlString(pool.toLowerCase())} }` : ''
  return `
    query presales {
      presales(${arg ? `${arg}` : ''}) {
        id
        name
        symbol
        chain
        pool
        raised
        goal
        price
        token
        state
        createdAt
      }
    }`.replace(/\s+/g, ' ').trim()
}

/** NFT balances for one owner. */
export function nftBalancesQuery(owner: string): string {
  return `
    query nftBalances {
      nftBalances(owner: ${gqlString(owner.toLowerCase())}) {
        id
        owner
        collection
        asset
        quantity
      }
    }`.replace(/\s+/g, ' ').trim()
}

/** All NFT collections. */
export function nftCollectionsQuery(): string {
  return `
    query nftCollections {
      nftCollections {
        id
        name
        symbol
        chain
        contract
        totalAssets
      }
    }`.replace(/\s+/g, ' ').trim()
}

/** NFT assets; optionally scoped to one collection contract. */
export function nftAssetsQuery(collection?: string): string {
  const arg = collection ? `where: { collection: ${gqlString(collection.toLowerCase())} }` : ''
  return `
    query nftAssets {
      nftAssets(${arg ? `${arg}` : ''}) {
        id
        collection
        tokenId
        name
        image
        owner
      }
    }`.replace(/\s+/g, ' ').trim()
}

/** Open bids; optionally scoped to one asset id. */
export function nftBidsQuery(asset?: string): string {
  const arg = asset ? `where: { asset: ${gqlString(String(asset).toLowerCase())} }` : ''
  return `
    query nftBids {
      nftBids(${arg ? `${arg}` : ''}) {
        id
        asset
        bidder
        price
        token
        active
        createdAt
      }
    }`.replace(/\s+/g, ' ').trim()
}

/** NFT activity; optionally scoped to one asset id. */
export function nftActivityQuery(asset?: string): string {
  const arg = asset ? `where: { asset: ${gqlString(String(asset).toLowerCase())} }` : ''
  return `
    query nftActivity {
      nftActivity(${arg ? `${arg}` : ''}) {
        id
        asset
        type
        from
        to
        price
        token
        timestamp
      }
    }`.replace(/\s+/g, ' ').trim()
}
