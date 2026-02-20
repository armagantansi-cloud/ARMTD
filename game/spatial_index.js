class SpatialIndex {
  constructor(cellSize = 1.5){
    const n = Number(cellSize);
    this.cellSize = Number.isFinite(n) && n > 0 ? n : 1.5;
    this._cells = new Map();
  }

  clear(){
    this._cells.clear();
  }

  _toCell(v){
    return Math.floor(v / this.cellSize);
  }

  _key(ix, iy){
    return `${ix},${iy}`;
  }

  insert(item, x = item?.x, y = item?.y){
    if (!item) return;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const ix = this._toCell(nx);
    const iy = this._toCell(ny);
    const key = this._key(ix, iy);
    let bucket = this._cells.get(key);
    if (!bucket) {
      bucket = [];
      this._cells.set(key, bucket);
    }
    bucket.push(item);
  }

  rebuild(items, include = null){
    this.clear();
    if (!Array.isArray(items) || !items.length) return;
    for (const item of items) {
      if (!item) continue;
      if (include && !include(item)) continue;
      this.insert(item, item.x, item.y);
    }
  }

  queryCircle(x, y, radius, out = []){
    out.length = 0;
    const nx = Number(x);
    const ny = Number(y);
    const nr = Number(radius);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nr) || nr <= 0) return out;

    const r2 = nr * nr;
    const minX = this._toCell(nx - nr);
    const maxX = this._toCell(nx + nr);
    const minY = this._toCell(ny - nr);
    const maxY = this._toCell(ny + nr);

    for (let iy = minY; iy <= maxY; iy += 1) {
      for (let ix = minX; ix <= maxX; ix += 1) {
        const bucket = this._cells.get(this._key(ix, iy));
        if (!bucket || !bucket.length) continue;
        for (const item of bucket) {
          const dx = item.x - nx;
          const dy = item.y - ny;
          if ((dx * dx + dy * dy) <= r2) out.push(item);
        }
      }
    }
    return out;
  }
}

export { SpatialIndex };
