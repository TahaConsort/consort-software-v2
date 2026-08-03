/**
 * lcService.js — Bank LC intake inbox (CRM_MASTER §5.21). Internal, for the
 * Operations inbox: review an inbound LC referral and convert it to a
 * customer + query, or reject it.
 */
import api from "@/lib/axios";

export const listReferrals = async (status) =>
  (await api.get(`/lc-referrals${status ? `?status=${status}` : ""}`)).data;

export const getReferral = async (id) => (await api.get(`/lc-referrals/${id}`)).data;

export const setReferralStatus = async (id, status) =>
  (await api.patch(`/lc-referrals/${id}/status`, { status })).data;

export const rejectReferral = async (id, reason) =>
  (await api.post(`/lc-referrals/${id}/reject`, { reason })).data;

export const convertReferral = async (id, payload = {}) =>
  (await api.post(`/lc-referrals/${id}/convert`, payload)).data;

/**
 * Read the LC PDF attached to a referral — SWIFT MT700/710 fields, the resolved port
 * codes and the raw text layer. Read-only: nothing is written until `applyExtraction`.
 */
export const extractReferral = async (id) => (await api.get(`/lc-referrals/${id}/extract`)).data;

/** Write the PDF's fields onto the referral (empty columns only unless `overwrite`). */
export const applyExtraction = async (id, overwrite = false) =>
  (await api.post(`/lc-referrals/${id}/extract/apply`, { overwrite })).data;
