// Implementation of the glue code in C handling required interfaces

#include "dataview-uniq.h" // Always required for the definition of the PID type
#include <stdlib.h>
#include <stdio.h>
#include "PrintTypesAsASN1.h"
#include "timeInMS.h"
#include "C_ASN1_Types.h"

static asn1SccT_Runtime_Error sender_recent_error = { .kind = T_Runtime_Error_noerror_PRESENT };

extern unsigned sender_initialized;

void sender_RI_ping_To_PID(asn1SccPID dest_pid, 
      const asn1SccDataItem *IN_param
);
void sender_RI_ping(
      const asn1SccDataItem *IN_param
);
void sender_RI_ping(
      const asn1SccDataItem *IN_param
)
{
   // When no destination is specified, send to everyone (multicast)
   sender_RI_ping_To_PID(PID_env, IN_param
);
}

void sender_RI_ping_To_PID(asn1SccPID dest_pid, 
      const asn1SccDataItem *IN_param
)
{
   // Log MSC data on Linux when environment variable is set
   static int innerMsc = -1;
   if (-1 == innerMsc)
      innerMsc = (NULL != getenv("TASTE_INNER_MSC"))?1:0;
   if (1 == innerMsc) {
      long long msc_time = getTimeInMilliseconds();
      // Log message to Receiver (corresponding PI: ping)
      printf ("INNER_RI: sender,receiver,ping,ping,%lld\n", msc_time);
      fflush(stdout);
   }
   int param_error_code = 0;
   // Encode parameter param using ASN.1 ACN
   
   static char IN_buf_param[asn1SccDataItem_REQUIRED_BYTES_FOR_ACN_ENCODING] = {0};
   int size_IN_buf_param =
      Encode_ACN_DataItem
        ((void *)&IN_buf_param,
          asn1SccDataItem_REQUIRED_BYTES_FOR_ACN_ENCODING,
          (asn1SccDataItem *)IN_param,
          &param_error_code);
   if (-1 == size_IN_buf_param) {
      puts ("[ERROR] ASN.1 Encoding failed in sender_RI_ping, parameter param");
      sender_recent_error.kind = T_Runtime_Error_encodeerror_PRESENT;
      sender_recent_error.u.encodeerror = param_error_code;
      return;
   }


   // Send the message via the middleware API
   extern void vm_sender_ping
     (asn1SccPID,
      void *, size_t);

   vm_sender_ping
     (dest_pid,
      (void *)&IN_buf_param, (size_t)size_IN_buf_param);


  sender_recent_error.kind = T_Runtime_Error_noerror_PRESENT;
}

// Get the PID of the sender function. The actual function is defined in _vm_if.c
// as the sender PID is received together with incoming PI calls
void sender_RI_get_sender(asn1SccPID *sender_pid)
{
  extern void sender_get_sender(asn1SccPID *sender_pid);
  sender_get_sender(sender_pid);
}

void sender_RI_get_last_error(asn1SccT_Runtime_Error* err)
{
    *err = sender_recent_error;
}

void sender_get_last_error(asn1SccT_Runtime_Error* err, const asn1SccPID* dest)
{
    sender_RI_get_last_error(err);
}

