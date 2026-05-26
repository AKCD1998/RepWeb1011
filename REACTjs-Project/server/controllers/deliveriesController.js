import { withTransaction } from "../db/pool.js";
import {
  assertUserCanReturnDispenseLine,
  createDispenseReturn,
  getDispenseLineReturnDetail,
} from "./dispenseReturnsService.js";

export async function returnDelivery(req, res) {
  const result = await withTransaction(async (client) => {
    const detail = await getDispenseLineReturnDetail(client, req.body?.dispenseLineId, {
      forUpdate: false,
    });
    await assertUserCanReturnDispenseLine(client, req.user, detail.branchId);
    return createDispenseReturn(client, {
      ...req.body,
      returnedByUserId: req.user?.id || req.body?.returnedByUserId || null,
      returnSource: req.body?.returnSource || "DELIVER_UI",
    });
  });

  return res.status(201).json({
    ok: true,
    ...result,
  });
}
