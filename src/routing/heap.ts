/** Binary min-heap of integer ids keyed by a numeric priority. Duplicates allowed (lazy deletion). */
export class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, priority: number): void {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(priority);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (pri[p] <= priority) break;
      ids[i] = ids[p];
      pri[i] = pri[p];
      i = p;
    }
    ids[i] = id;
    pri[i] = priority;
  }

  /** Removes and returns the id with the lowest priority. Caller must check `size` first. */
  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastPri = pri.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pri[r] < pri[l] ? r : l;
        if (pri[c] >= lastPri) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastPri;
    }
    return top;
  }
}
