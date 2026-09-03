import { useCallback, useEffect, useState } from 'react'
import { WalletProvider, useWallet } from './lib/wallet.tsx'
import { readLaunches, readMinProjectBps, type Launch } from './lib/launchpad.ts'
import { useRoute } from './lib/router.ts'
import { Header } from './components/Header.tsx'
import { Hero } from './components/Hero.tsx'
import { HowItWorks } from './components/HowItWorks.tsx'
import { HowItWorksPage } from './components/HowItWorksPage.tsx'
import { LaunchForm } from './components/LaunchForm.tsx'
import { Launches } from './components/Launches.tsx'
import { Explore } from './components/Explore.tsx'
import { MyTokens } from './components/MyTokens.tsx'
import { ClaimFees } from './components/ClaimFees.tsx'
import { ClaimRepo } from './components/ClaimRepo.tsx'
import { TokenPage } from './components/TokenPage.tsx'
import { Footer } from './components/Footer.tsx'

function Site() {
  const route = useRoute()
  const { address } = useWallet()
  const [launches, setLaunches] = useState<Launch[]>([])
  const [minBps, setMinBps] = useState(5000)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    /* ⚠ Block-bodied, not a concise arrow. A `useEffect(() => promise)` returns the promise as if it
       were a cleanup function, and React 19 renders a blank page with no error, which passes every
       headless check because Playwright's Chromium renders it fine. */
    void (async () => {
      try {
        const [l, m] = await Promise.all([readLaunches(), readMinProjectBps()])
        setLaunches(l)
        setMinBps(m)
      } catch {
        /* The chain being unreachable must not blank the page: each section renders its own empty
           state and the launch form still validates. */
      } finally {
        setLoading(false)
      }
    })()
  }, [address])

  useEffect(() => { refresh() }, [refresh])

  return (
    <>
      <Header route={route} />
      <main>
        {route.name === 'token' ? (
          <TokenPage address={route.address} />
        ) : route.name === 'mine' ? (
          <MyTokens launches={launches} loading={loading} />
        ) : route.name === 'claim' ? (
          <ClaimFees launches={launches} loading={loading} onDone={refresh} />
        ) : route.name === 'how' ? (
          <HowItWorksPage />
        ) : route.name === 'claim-repo' ? (
          <ClaimRepo />
        ) : route.name === 'explore' ? (
          <Explore launches={launches} loading={loading} />
        ) : route.name === 'launch' ? (
          <LaunchForm minBps={minBps} onLaunched={refresh} />
        ) : (
          <>
            <Hero launches={launches} minBps={minBps} loading={loading} />
            <HowItWorks />
            <Launches launches={launches} loading={loading} />
          </>
        )}
      </main>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <WalletProvider>
      <Site />
    </WalletProvider>
  )
}
