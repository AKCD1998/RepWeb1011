import { Router } from "express";
import {
  createMovement,
  receiveInventory,
  transferInventory,
  updateMovementOccurredAtCorrection,
} from "../controllers/inventoryController.js";
import { requireBranchAccess, requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post(
  "/receive",
  verifyToken,
  requireRole("ADMIN", "PHARMACIST"),
  requireBranchAccess({
    matchBodyFields: ["toBranchCode"],
    forceBodyFields: ["toBranchCode"],
  }),
  asyncHandler(receiveInventory)
);
router.post(
  "/transfer",
  verifyToken,
  requireRole("ADMIN", "PHARMACIST"),
  requireBranchAccess({
    matchBodyFields: ["fromBranchCode"],
    forceBodyFields: ["fromBranchCode"],
  }),
  asyncHandler(transferInventory)
);
router.post(
  "/movements",
  verifyToken,
  requireRole("ADMIN", "PHARMACIST"),
  asyncHandler(createMovement)
);
router.patch(
  "/movements/:id/occurred-at-correction",
  verifyToken,
  requireRole("ADMIN"),
  asyncHandler(updateMovementOccurredAtCorrection)
);

export default router;
