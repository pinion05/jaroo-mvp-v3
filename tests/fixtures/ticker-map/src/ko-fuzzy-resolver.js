module.exports = {
  createKoFuzzyResolver() {
    return {
      resolve(query, options = {}) {
        const normalizedQuery = String(query ?? '').trim().toLowerCase()
        const topN = typeof options.topN === 'number' ? options.topN : undefined

        const matches = normalizedQuery.includes('마이크로') || normalizedQuery.includes('microsoft')
          ? [
              {
                ticker: 'MSFT',
                canonicalKo: '마이크로소프트',
                canonicalEn: 'Microsoft Corporation',
                via: 'exact',
                score: 0.99,
                recallRank: 1,
                names: ['마이크로소프트', 'Microsoft Corporation'],
              },
            ]
          : []

        return typeof topN === 'number' ? matches.slice(0, topN) : matches
      },
    }
  },
}
