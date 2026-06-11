import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supplierApi } from '@/api/supplier'

export const useSupplierStore = defineStore('supplier', () => {
  const profile = ref<any>(null)
  const status = ref<any>(null)
  const dashboardStats = ref<any>(null)
  const contacts = ref<any[]>([])
  const qualifications = ref<any[]>([])
  const changeRecords = ref<any[]>([])
  const evaluations = ref<any[]>([])
  const evaluationStats = ref<any>(null)
  const bidSubmissions = ref<any[]>([])
  const loading = ref(false)

  async function fetchProfile() {
    loading.value = true
    try {
      profile.value = await supplierApi.getProfile()
    } finally {
      loading.value = false
    }
  }

  async function fetchStatus() {
    status.value = await supplierApi.getStatus()
  }

  async function fetchDashboardStats() {
    dashboardStats.value = await supplierApi.getDashboardStats()
  }

  async function fetchContacts() {
    contacts.value = await supplierApi.listContacts() as any
  }

  async function addContact(data: any) {
    await supplierApi.addContact(data)
    await fetchContacts()
  }

  async function updateContact(contactId: string, data: any) {
    await supplierApi.updateContact(contactId, data)
    await fetchContacts()
  }

  async function deleteContact(contactId: string) {
    await supplierApi.deleteContact(contactId)
    await fetchContacts()
  }

  async function fetchQualifications() {
    qualifications.value = await supplierApi.listQualifications() as any
  }

  async function addQualification(data: any) {
    await supplierApi.addQualification(data)
    await fetchQualifications()
  }

  async function deleteQualification(qualificationId: string) {
    await supplierApi.deleteQualification(qualificationId)
    await fetchQualifications()
  }

  async function fetchChangeRecords() {
    changeRecords.value = await supplierApi.listChangeRecords() as any
  }

  async function createChangeRequest(data: any) {
    await supplierApi.createChangeRequest(data)
    await fetchChangeRecords()
  }

  async function fetchEvaluations() {
    evaluations.value = await supplierApi.listEvaluations() as any
  }

  async function fetchEvaluationStats() {
    evaluationStats.value = await supplierApi.getEvaluationStats()
  }

  async function fetchBidSubmissions() {
    bidSubmissions.value = await supplierApi.listBidSubmissions() as any
  }

  return {
    profile, status, dashboardStats, contacts, qualifications,
    changeRecords, evaluations, evaluationStats, bidSubmissions, loading,
    fetchProfile, fetchStatus, fetchDashboardStats,
    fetchContacts, addContact, updateContact, deleteContact,
    fetchQualifications, addQualification, deleteQualification,
    fetchChangeRecords, createChangeRequest,
    fetchEvaluations, fetchEvaluationStats,
    fetchBidSubmissions,
  }
})
