import { redirect } from 'next/navigation'

type RootPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

function appendSearchParam(query: URLSearchParams, key: string, value: string | string[] | undefined) {
  if (typeof value === 'string') {
    query.append(key, value)
    return
  }

  value?.forEach((entry) => query.append(key, entry))
}

export default async function Page({ searchParams }: RootPageProps = {}) {
  const params = await searchParams
  if (params?.code) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      appendSearchParam(query, key, value)
    }

    redirect(`/auth/callback?${query.toString()}`)
  }

  redirect('/home')
}
