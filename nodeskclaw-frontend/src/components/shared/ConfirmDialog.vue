<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useConfirmState } from '@/composables/useConfirm'
import { TriangleAlert } from 'lucide-vue-next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const { t } = useI18n()
const { state, handleConfirm, handleCancel } = useConfirmState()
</script>

<template>
  <AlertDialog :open="state.visible">
    <AlertDialogContent @escape-key-down="handleCancel">
      <AlertDialogHeader>
        <AlertDialogTitle v-if="state.title" class="flex items-center gap-2">
          <TriangleAlert
            v-if="state.variant === 'danger'"
            class="w-5 h-5 text-red-400 shrink-0"
          />
          {{ state.title }}
        </AlertDialogTitle>
        <AlertDialogDescription class="leading-relaxed">
          {{ state.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel v-if="!state.isAlert" @click="handleCancel">
          {{ state.cancelText || t('common.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction
          :class="state.variant === 'danger' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''"
          @click="handleConfirm"
        >
          {{ state.confirmText || t('common.confirm') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
