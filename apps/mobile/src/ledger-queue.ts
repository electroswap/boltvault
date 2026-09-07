/**
 * One APDU on the wire at a time.
 *
 * Owner, with a Ledger attached over OTG: "I also see an error saying 'An
 * action was already pending on the Ledger device. Please deny or reconnect',
 * but there is nothing pending on the device."
 *
 * Nothing was. That message is `TransportRaceCondition` from
 * @ledgerhq/hw-transport, thrown by its atomic guard when a second exchange
 * starts while one is still in flight — it describes a state of the transport,
 * not of the device, which is why the Ledger looked idle.
 *
 * The caller is right to be concurrent: HardwarePickers derives both address
 * schemes at once with `Promise.all`, which is what makes the account list
 * appear in one step instead of two. Serialising belongs here, at the
 * transport, whose job is to own the wire. The extension never hit this
 * because its WebHID transport is hand-rolled and has no such guard; the React
 * Native transports extend Ledger's Transport class, which does.
 */
type Job<T> = () => Promise<T>

/**
 * Returns a function that runs jobs strictly in order. A failure resolves that
 * job only — the queue keeps draining, or one bad APDU would wedge every
 * later call.
 */
export function serial(): <T>(job: Job<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(job: Job<T>): Promise<T> => {
    const run = tail.then(job, job)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
